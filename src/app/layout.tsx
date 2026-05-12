import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  metadataBase: new URL('https://threadline.app'),
  title: { default: 'Threadline', template: '%s · Threadline' },
  description: 'Case intelligence for the people who refuse to give up.',
  icons: {
    icon: '/brand/icon.png',
    apple: '/brand/icon.png',
  },
  openGraph: {
    title: 'Threadline',
    description: 'Case intelligence for the people who refuse to give up.',
    url: 'https://threadline.app',
    siteName: 'Threadline',
    images: [{ url: '/brand/logo.png', width: 1200, height: 630, alt: 'Threadline' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Threadline',
    description: 'Case intelligence for the people who refuse to give up.',
    images: ['/brand/logo.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
