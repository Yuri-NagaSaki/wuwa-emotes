import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { SettingsPanel } from '#/ui/account/SettingsPanel'

const me = getRouteApi('/_site/me')

// 个人中心 › 设置 (the summary comes from the /me layout loader).
export const Route = createFileRoute('/_site/me/settings')({
  component: function Settings() {
    const { summary } = me.useLoaderData()
    return <SettingsPanel summary={summary} />
  },
})
