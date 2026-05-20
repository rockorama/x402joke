export const metadata = {
  title: 'x402joker',
  description: 'Pay-per-joke vending machine over x402. Self-describing endpoint for agents.',
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
