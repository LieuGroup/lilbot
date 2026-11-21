/** One row of a facts card (`<dl>`): a muted label on the left, its value on the right. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-foreground/6 px-3 py-2.5 not-first:border-t">
      <dt className="text-[13px]/[18px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px]/[18px]">{value}</dd>
    </div>
  )
}
