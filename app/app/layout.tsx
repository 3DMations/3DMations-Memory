import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SettingsMenu from "./_components/ui/SettingsMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Memory Hub",
  description: "3DMations Claude memory hub",
};

// Inline script: applies theme from localStorage BEFORE first paint, so no flash.
// Default is dark when no preference is stored.
const themeScript = `
(function(){try{
  var t = localStorage.getItem('memory-hub:theme');
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.classList.add(t);
}catch(e){
  document.documentElement.classList.add('dark');
}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text">
        <SettingsMenu />
        {children}
      </body>
    </html>
  );
}
