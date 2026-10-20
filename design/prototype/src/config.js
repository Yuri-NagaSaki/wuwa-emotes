// Site identity lives in one place (production: SITE_NAME / SITE_DOMAIN env, overridable in 系统设置).
const SITE = { name: '潮池', sub: '鸣潮表情图鉴', domain: 'chaochi.example', slug: 'chaochi' };
// Three roles. 站长 holds every permission; 管理员 runs packs + comments + submissions; every 用户 may submit packs.
// Menus only mirror these; the server checks the permission on every route and action.
const ROLES = {
  admin: { name: '站长', perms: ['*'] },
  manager: { name: '管理员', perms: ['dash', 'packs', 'review', 'upload', 'taxonomy', 'comments'] },
  user: { name: '用户', perms: ['submit'] }
};
const can = (role, perm) => { const r = ROLES[role] || ROLES.admin; return r.perms.includes('*') || r.perms.includes(perm); };
