import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main>
      <h1>潮池</h1>
    </main>
  )
}
