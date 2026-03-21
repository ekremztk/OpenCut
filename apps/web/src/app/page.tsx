import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'

export default function Home() {
  redirect(`/editor/${randomUUID()}`)
}
