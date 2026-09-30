import adapter from '@sveltejs/adapter-static'

export default {
  kit: {
    adapter: adapter({ pages: 'build' }),
    files: { routes: 'web/routes', appTemplate: 'web/app.html', lib: 'src/ui', assets: 'public' },
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'https://fonts.googleapis.com', 'unsafe-inline'],
        'font-src': ['https://fonts.gstatic.com'],
        'img-src': ['self', 'data:'],
        'connect-src': ['self'],
        'base-uri': ['self'],
        'object-src': ['none'],
      },
    },
  },
}
