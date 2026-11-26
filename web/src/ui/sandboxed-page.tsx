/** The frame a bot's page is drawn in (Library preview and the chat's HTML view, #317); see `page-document.ts`. */
import { PAGE_SANDBOX, pageDocument } from './page-document'

export function SandboxedPage({ title, text, className, style }: { title: string; text: string; className?: string; style?: { height: number } }) {
  return <iframe title={title} sandbox={PAGE_SANDBOX} srcDoc={pageDocument(text)} referrerPolicy="no-referrer" className={className} style={style} />
}
