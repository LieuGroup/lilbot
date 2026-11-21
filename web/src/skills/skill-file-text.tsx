import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { withoutFrontmatter } from './skill-lines'

const heading = ({ children }: { children?: ReactNode }) => <p className="text-[13px]/5 font-semibold">{children}</p>

/** Skill text is written by bots and imports. Markdown is drawn without raw HTML; images are dropped, so opening a skill
 *  never fetches anything; only web links stay links, and they open in a new tab. */
const components: Components = {
  h1: ({ children }) => <p className="text-sm/5 font-semibold">{children}</p>,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs/[18px]">{children}</pre>,
  code: ({ children }) => <code className="font-mono text-xs">{children}</code>,
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    )
}

/** The selected file, read-only: a markdown file drawn as text with its structure, anything else as plain text. */
export function SkillFileText({ path, text }: { path: string; text: string }) {
  if (!/\.md$/i.test(path)) return <pre className="overflow-x-auto font-mono text-xs/[18px] whitespace-pre-wrap break-words">{text}</pre>
  return (
    <div className="flex flex-col gap-2 text-[13px]/5 break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={['img']} skipHtml>
        {path === 'SKILL.md' ? withoutFrontmatter(text) : text}
      </Markdown>
    </div>
  )
}
