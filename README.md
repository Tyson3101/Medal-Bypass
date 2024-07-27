# [Medal Bypass](https://medalbypass.web.app)

### Where

##### Check the website here: [https://medalbypass.vercel.app](https://medalbypass.vercel.app)

### What

##### A tool to download Medal clips without watermarks!

### Why

##### Medal has a paywall in the way of downloading clips without watermaks...

### How

##### Fetch . Simple

---

## API - Get through a GET / POST Request

### GET:

`https://medalbypass.vercel.app/api/clip?url=<Url of Medal Clip>`
`https://medalbypass.vercel.app/api/clip?id=<ID of Medal Clip>`

### POST

```
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"<your-clip-url>"}' \
  https://medalbypass.vercel.app/api/clip
```

##### `'{"url":"<your-url>"}'` can be replaced with `'{"id":"<your-clip-id>"}'`

### RESPONSE (JSON)

```json
{
  "valid": true/false,
  "src": "<MEDAL CLIP MP4 URL>"   *IF VALID
  "reasoning": "<REASON FOR ERROR>"   *IF INVALID
}
```

###### By Tyson3101
