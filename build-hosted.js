const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'public');
const dist = path.join(__dirname, 'dist', 'server');
fs.mkdirSync(dist, { recursive: true });
const sources = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/map.css': ['map.css', 'text/css; charset=utf-8']
};
const files = Object.fromEntries(Object.entries(sources).map(([url, [file, type]]) => [url, { body: fs.readFileSync(path.join(root, file), 'utf8'), type }]));
const worker = `const files=${JSON.stringify(files)};export default {fetch(request){const url=new URL(request.url);const file=files[url.pathname];if(file)return new Response(file.body,{headers:{'content-type':file.type,'cache-control':'no-store'}});return new Response('Not found',{status:404})}};`;
fs.writeFileSync(path.join(dist, 'index.js'), worker);
