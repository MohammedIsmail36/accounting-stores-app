import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const normalizeBasePath = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return "/";

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: normalizeBasePath(env.VITE_APP_BASE_PATH),
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      // Avoid the extra memory spike from gzipping every output chunk during
      // production builds on the deployment server.
      reportCompressedSize: false,
    },
  };
});
