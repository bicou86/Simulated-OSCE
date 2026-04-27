import fs from 'fs';
const file = 'client/src/components/layout/AppLayout.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /<Link key=\{item\.href\} href=\{item\.href\}>\s*<a className=\{cn\([\s\S]*?hover:text-foreground active:scale-95"\s*\)\}>/m,
  `<Link key={item.href} href={item.href} className={cn(
                  "flex items-center gap-3 px-3 py-3 md:px-4 md:py-4 rounded-xl transition-all duration-200 group relative",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:scale-95"
                )}>`
);
content = content.replace(
  /<\/a>\s*<\/Link>/g,
  '</Link>'
);
fs.writeFileSync(file, content);
