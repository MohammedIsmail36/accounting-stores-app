// UI-only Staging rollout. The database migration was applied separately.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [source, backup, mode] = process.argv.slice(2);
if (!source?.startsWith('/tmp/accounting-staging-draft-delete-source-')
    || !backup?.startsWith('/opt/backups/accounting-app/staging-inventory-draft-delete-ui-before-')
    || (mode !== undefined && mode !== '--check')) {
  throw new Error('حدد مصدر البناء ونسخة واجهة Staging؛ --check للفحص دون نشر');
}

const root = '/opt/accounting-app';
const live = '/var/www/staging.alibea2020.com';
const projectRef = 'dunzfxurefzlaamgghys';
const api = `https://${projectRef}.supabase.co`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (path) => hash(readFileSync(path));
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || `${command} failed`);
  }
  return result.stdout?.trim() ?? '';
};

const build = JSON.parse(readFileSync(join(source, 'build-manifest.json'), 'utf8'));
const guard = JSON.parse(readFileSync(join(backup, 'DEPLOY_GUARD.json'), 'utf8'));
if (build.result !== 'STAGING_DRAFT_DELETE_UI_BUILD_READY'
    || guard.result !== 'STAGING_DRAFT_DELETE_UI_BACKUP_OK'
    || build.source !== source || guard.source !== source
    || guard.build !== build.build
    || build.commit !== run('git', ['rev-parse', 'HEAD'])
    || readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== projectRef) {
  throw new Error('هوية الفرع أو البناء أو نسخة Staging غير متطابقة');
}

const assets = readdirSync(join(build.build, 'assets'));
const formAssets = assets.filter((name) => /^InventoryAdjustmentForm-[^/]+\.js$/.test(name));
if (formAssets.length !== 1) throw new Error('ملف شاشة التسوية في البناء غير محدد');
const formAsset = `assets/${formAssets[0]}`;
const form = readFileSync(join(build.build, formAsset), 'utf8');
if (!form.includes('ملاحظات البند') || !form.includes('سبب فرق المخزون')
    || !form.includes('اختر السبب') || form.includes('ملاحظات حول عملية الجرد')) {
  throw new Error('بناء الشاشة لا يحتوي على التصميم المصحح');
}

function preflight() {
  run('sha256sum', ['-c', '--quiet', 'SHA256SUMS'], backup);
  run('diff', ['-qr', '--exclude=SHA256SUMS', '--exclude=DEPLOY_GUARD.json',
    '--exclude=deploy-report.json', live, backup]);
  if (fileHash(join(live, 'index.html')) !== guard.liveIndexSha256
      || fileHash(join(build.build, 'index.html')) !== build.indexSha256
      || fileHash('/var/www/farida/index.html') !== guard.faridaIndexSha256
      || fileHash('/var/www/alibea/index.html') !== guard.alibeaIndexSha256
      || statSync(build.build).mode % 0o1000 !== 0o755) {
    throw new Error('تغيرت واجهة Staging أو البناء أو إحدى واجهتي الإنتاج بعد النسخ');
  }
  const main = readFileSync(join(build.build, build.mainAsset), 'utf8');
  if (!main.includes(api) || !form.includes('save_inventory_adjustment_draft_with_reasons')) {
    throw new Error('بناء الواجهة لا يشير إلى API أو دالة الحفظ المطلوبة');
  }
  const keys = [...new Set(main.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [])];
  const key = keys.find((candidate) => {
    try {
      const payload = JSON.parse(Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'));
      return payload.ref === projectRef && payload.role === 'anon' && payload.exp * 1000 > Date.now();
    } catch { return false; }
  });
  if (!key || hash(key) !== build.keySha256) throw new Error('مفتاح Staging العام لا يطابق البناء');
  return key;
}

async function verify(key) {
  for (const path of ['/', '/inventory-adjustments', '/inventory-adjustments/new']) {
    const response = await fetch(`https://staging.alibea2020.com${path}`, {
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== build.indexSha256) {
      throw new Error(`استجابة Staging غير مطابقة: ${path}`);
    }
  }
  for (const asset of [build.mainAsset, formAsset]) {
    const response = await fetch(`https://staging.alibea2020.com/${asset}`, {
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== fileHash(join(build.build, asset))) {
      throw new Error(`أصل Staging غير مطابق: ${asset}`);
    }
  }
  const response = await fetch(`${api}/rest/v1/company_settings?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200) throw new Error(`رفض API المفتاح العام: ${response.status}`);
  if (fileHash('/var/www/farida/index.html') !== guard.faridaIndexSha256
      || fileHash('/var/www/alibea/index.html') !== guard.alibeaIndexSha256) {
    throw new Error('تغيرت إحدى واجهتي الإنتاج');
  }
}

async function main() {
  const key = preflight();
  if (mode === '--check') {
    console.log('حارس نشر واجهة التسوية جاهز؛ لم يُنشر شيء');
    return;
  }
  preflight();
  let copied = false;
  try {
    copied = true;
    run('rsync', ['-a', '--delay-updates', `${build.build}/`, `${live}/`]);
    if (fileHash(join(live, 'index.html')) !== build.indexSha256) {
      throw new Error('index.html المنشور لا يطابق البناء');
    }
    await verify(key);
  } catch (error) {
    if (copied) {
      run('rsync', ['-a', '--no-perms', '--delay-updates', '--exclude=SHA256SUMS',
        '--exclude=DEPLOY_GUARD.json', '--exclude=deploy-report.json', `${backup}/`, `${live}/`]);
      if (fileHash(join(live, 'index.html')) !== guard.liveIndexSha256) {
        throw new Error(`فشل النشر والرجوع: ${error.message}`);
      }
      throw new Error(`فشل النشر واستُعيدت واجهة Staging: ${error.message}`);
    }
    throw error;
  }
  writeFileSync(join(backup, 'deploy-report.json'), `${JSON.stringify({
    result: 'STAGING_ADJUSTMENT_REASON_LAYOUT_UI_DEPLOYED',
    buildCommit: build.commit, mainAsset: build.mainAsset, formAsset,
    indexSha256: build.indexSha256, faridaUntouched: true, alibeaUntouched: true,
    deployedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  console.log('تم نشر تصميم التسوية على Staging والتحقق من الواجهة وAPI');
  console.log(`MAIN_ASSET=${build.mainAsset}`);
  console.log(`FORM_ASSET=${formAsset}`);
  console.log('واجهتا Farida وAlibea لم تتغيرا');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
