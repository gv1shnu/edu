/** Renders lesson/notes HTML that the server already sanitised (see server/html.ts). */
export function HtmlView({ html }: { html: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
