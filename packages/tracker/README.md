# @noomers/tracker

Client-side page view tracking library for [noomers](https://noomers.dev).

_For instructions on downloading and deploying the [noomers server](https://github.com/harshil1712/noomers), consult the [project README](https://github.com/harshil1712/noomers/blob/master/packages/server/README.md)._

## Usage

In your browser-based web project:

```bash
npm install @noomers/tracker
```

Initialize noomers with your site ID and deployment URL:

```typescript
import * as noomers from "@noomers/tracker";

noomers.init({
    siteId: "your-unique-site-id",
    deploymentUrl: "https://{subdomain-emitted-during-deploy}.pages.dev/",
});
```

That's it! Your page views will automatically be tracked and reported to noomers.

## Advanced

### Manually Track Pageviews

Alternatively you can track page view events manually.

To do so, during initialization set `autoTrackPageviews` to `false`. Then, you manually call `noomers.trackPageview()` when you want to record a pageview.

```typescript
import * as noomers from "@noomers/tracker";

noomers.init({
    siteId: "your-unique-site-id",
    deploymentUrl: "https://{subdomain-emitted-during-deploy}.pages.dev/",
    autoTrackPageviews: false, // <- don't forget this
});

// ... when a pageview happens
noomers.trackPageview();
```
