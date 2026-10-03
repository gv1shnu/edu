"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { Copy, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";
import { slugify } from "@edu/shared";
function Code({ children, className }: { children?: any; className?: string }) {
  const code = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "");
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (lang)
      codeToHtml(code, {
        lang: ["sql", "python", "bash", "javascript", "json"].includes(lang)
          ? lang
          : "text",
        theme: "github-dark",
      }).then(setHtml);
  }, [code, lang]);
  if (!lang) return <code>{children}</code>;
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{lang.toUpperCase()}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          aria-label="Copy code"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
const textOf = (node: any): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : node?.props
        ? textOf(node.props.children)
        : "";
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          h2: ({ children }) => (
            <h2 id={slugify(textOf(children))}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 id={slugify(textOf(children))}>{children}</h3>
          ),
          code: Code,
          pre: ({ children }) => <>{children}</>,
          a: ({ children, ...props }) => (
            <a {...props} rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
