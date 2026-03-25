interface BubbleTailProps {
  align: "left" | "right"
}

export function BubbleTail({ align }: BubbleTailProps) {
  if (align === "right") {
    return (
      <svg
        viewBox="0 0 17 21"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute bottom-[-1px] right-[-4.28px] h-[18px] text-[var(--chat-bubble-self)]"
      >
        <path
          d="M16.8869 20.1846C11.6869 20.9846 6.55352 18.1212 4.88685 16.2879C6.60472 12.1914 -4.00107 2.24186 2.99893 2.24148C4.61754 2.24148 6 -1.9986 11.8869 1.1846C11.9081 2.47144 11.8869 6.92582 11.8869 7.6842C11.8869 18.1842 17.8869 19.5813 16.8869 20.1846Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 17 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute bottom-[-1px] left-[-4.26px] h-[18px] scale-x-[-1] text-[var(--chat-bubble-peer)]"
    >
      <path
        d="M16.8869 20.1846C11.6869 20.9846 6.55352 18.1212 4.88685 16.2879C6.60472 12.1914 -4.00107 2.24186 2.99893 2.24148C4.61754 2.24148 6 -1.9986 11.8869 1.1846C11.9081 2.47144 11.8869 6.92582 11.8869 7.6842C11.8869 18.1842 17.8869 19.5813 16.8869 20.1846Z"
        fill="currentColor"
      />
    </svg>
  )
}
