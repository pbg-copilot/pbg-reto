import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

// Markdown sin HTML crudo (react-markdown lo ignora por defecto) ni imágenes externas.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 text-sm leading-relaxed", className)}>
      <ReactMarkdown
        disallowedElements={["img"]}
        components={{
          ol: (props) => <ol className="flex list-decimal flex-col gap-1 pl-5" {...props} />,
          ul: (props) => <ul className="flex list-disc flex-col gap-1 pl-5" {...props} />,
          a: ({ href, ...props }) => (
            <a href={href} className="font-medium text-primary underline dark:text-brand" rel="noopener noreferrer" {...props} />
          ),
          strong: (props) => <strong className="font-semibold" {...props} />,
          code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
