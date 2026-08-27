// 在线模式配置（Cloudflare Pages Functions + KV，全免费）。
// apiBase：留空 = 与前端同域（推荐，部署到 Pages 后自动同域，无跨域问题）。
//   若前端与 API 分离部署才需填完整地址，如 'https://xxx.pages.dev'。
// requirePassphrase：true = 打开时要求输入访问口令（各设备一致则记录共享）。
window.__CLOUDFLARE_CONFIG__ = {
  apiBase: '',
  requirePassphrase: true
};
