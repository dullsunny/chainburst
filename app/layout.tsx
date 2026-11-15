import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '爆炸棋 · Chainburst',
  description: '支持 2–6 人、连锁爆炸与自定义地图的策略棋类游戏。',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
