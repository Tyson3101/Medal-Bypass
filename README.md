# [Medal Bypass](https://medalbypass.web.app)

### Where

##### Check the website here: [https://medalbypass.vercel.app](https://medalbypass.vercel.app)

### What

##### A tool to download Medal clips without watermarks!

### Why

##### Medal has a paywall in the way of downloading clips without watermaks...

### How

##### Fetch . Simple

-----

## API - Get through a POST / GET Request

### GET:

`https://us-central1-medalbypass.cloudfunctions.net/medalwatermark?url="Encoded url of Medal Clip"`

### POST

```
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"<your-url>"}' \
  https://us-central1-medalbypass.cloudfunctions.net/medalwatermark
```

###### By Tyson3101
