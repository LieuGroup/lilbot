/** Where registered Settings sections render: each one inside its own `SettingsSectionErrorBoundary`, so a section
 *  that throws shows "This section could not load." in its place instead of blanking Settings or its pushed page.
 *  No hooks here, so tests walk the returned element tree and prove every section sits inside a boundary. */
import { Fragment } from 'react'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { SettingsSectionErrorBoundary } from './section-error-boundary'
import type { SettingsSectionDefinition, SettingsSectionProps } from './sections'

export function SettingsSectionList({ navSections, inlineSections, ...props }: SettingsSectionProps & { navSections: readonly SettingsSectionDefinition[]; inlineSections: readonly SettingsSectionDefinition[] }) {
  return (
    <>
      {navSections.length > 0 ? (
        <SectionGroup title="LilBot">
          {navSections.map((section, index) => (
            <Fragment key={section.id}>
              {index > 0 ? <RowDivider /> : null}
              <SettingsSectionErrorBoundary sectionId={section.id}>
                <section.Component {...props} />
              </SettingsSectionErrorBoundary>
            </Fragment>
          ))}
        </SectionGroup>
      ) : null}
      {inlineSections.map(section => (
        <SettingsSectionErrorBoundary key={section.id} sectionId={section.id}>
          <section.Component {...props} />
        </SettingsSectionErrorBoundary>
      ))}
    </>
  )
}

/** A registered section's pushed page (`/(settings)/[section]`), isolated the same way. */
export function SettingsSectionPage({ section }: { section: SettingsSectionDefinition }) {
  const Detail = section.DetailScreen
  if (!Detail) return null
  return (
    <SettingsSectionErrorBoundary sectionId={section.id}>
      <Detail />
    </SettingsSectionErrorBoundary>
  )
}
