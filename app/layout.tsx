export const metadata = {
  title: 'x402joke',
  description: 'x402 demo that sells Claude-generated jokes',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '48px auto', padding: '0 24px' }}>
        {children}
      </body>
    </html>
  )
}
