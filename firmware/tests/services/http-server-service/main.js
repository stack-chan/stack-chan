import { HttpServerService, Response } from 'http-server-service'

let app = new HttpServerService()

app.get('/response', (c) => {
  return new Response('Thank you for coming', {
    status: 201,
    headers: {
      'X-Message': 'Hello',
      'Content-Type': 'text/plain',
    },
  })
})

app.get('/header', (c) => {
  const userAgent = c.req.header('User-Agent')
  return c.text(`Your UserAgent is ${userAgent}`)
})

app.get('/query', (c) => {
  const text = c.req.query('text')
  return c.text(`Your  query is ${text}`)
})

app.get('/json', (c) => {
  const posts = [
    { id: 1, title: 'Good Morning' },
    { id: 2, title: 'Good Afternoon' },
    { id: 3, title: 'Good Evening' },
    { id: 4, title: 'Good Night' },
  ]
  return c.json(posts)
})

app.post('/post/text', async (c) => {
  const text = await c.req.text()
  return c.json({ message: `${text} received!` }, 201)
})

app.post('/post/json', async (c) => {
  const json = await c.req.json()
  return c.json(json)
})

app.post('/post/form', async (c) => {
  const form = await c.req.formData()
  return c.text(`form: ${JSON.stringify(form)}`)
})
