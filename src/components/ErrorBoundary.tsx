import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  section?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.section) {
        return (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center space-y-2"
            dir="rtl"
          >
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "حدث خطأ في هذا القسم"}
            </p>
            <Button size="sm" variant="outline" onClick={this.handleReset}>
              إعادة المحاولة
            </Button>
          </div>
        );
      }
      return (
        <div
          className="flex min-h-screen items-center justify-center p-8"
          dir="rtl"
        >
          <div className="mx-auto max-w-md text-center space-y-4">
            <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="text-xl font-semibold">حدث خطأ غير متوقع</h2>
            <p className="text-muted-foreground text-sm">
              {this.state.error?.message || "حدث خطأ أثناء عرض الصفحة"}
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={this.handleReset}>إعادة المحاولة</Button>
              <Button
                variant="outline"
                onClick={() => window.location.assign(import.meta.env.BASE_URL)}
              >
                العودة للرئيسية
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
