interface ControlNoticeProps {
  text: string
}

export function ControlNotice({ text }: ControlNoticeProps) {
  return (
    <div className="mx-auto rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}
