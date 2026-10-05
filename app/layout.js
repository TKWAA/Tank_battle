import './globals.css';

export const metadata = {
  title: '猪猪坦克 - Piggy Tank',
  description: '经典猪猪坦克游戏，使用 Next.js 构建',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
