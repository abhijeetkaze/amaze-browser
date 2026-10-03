import React from 'react'

// Outline icons from Lucide (https://lucide.dev, ISC license), one family for the whole UI

type IconProps = React.SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Icon>
  )
}
export function ArrowRightIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  )
}
export function ReloadIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Icon>
  )
}
export function StopIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  )
}
export function HistoryIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Icon>
  )
}
export function DeviceIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </Icon>
  )
}
export function PlusIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  )
}
export function LockIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  )
}
export function GlobeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </Icon>
  )
}
export function FileIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </Icon>
  )
}
export function SearchIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  )
}
export function ChevronUpIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  )
}
export function ChevronDownIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}
