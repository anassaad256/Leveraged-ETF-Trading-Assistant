import './globals.css';

export const metadata = {
  title: 'Leveraged ETF Trading Assistant',
  description: 'Crash-aware quintile mean-reversion analysis for 2×/3× leveraged ETFs',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
