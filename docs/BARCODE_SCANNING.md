# Barcode product identification

Open `/new`, choose **Scan barcode**, then use the camera, select a photo or enter the digits. Review the returned name and source before choosing **Add to request**. Existing request text is retained. This action does not submit a plan or purchase anything.

## Supported input

- EAN-8, UPC-A, EAN-13 and GTIN-14 digits, including their check digit. Leading zeros are preserved; spaces and hyphens are accepted when typing.
- Camera and image decoding uses ZXing for EAN-8, UPC-A, EAN-13 and ITF (accepted only when the decoded value is a valid retail GTIN). QR codes and UPC-E are not supported.
- JPG, PNG or WebP photos up to 10 MB. Images are resized to at most 2,400 pixels on their longest side for decoding. A sharp image with the entire barcode and clear margins works best.
- Camera access requires HTTPS or localhost, a compatible browser and user permission. Denied permission or a missing camera leaves photo and manual entry available.

Frames and selected photos remain on the device. Only the decoded digits go to the server and the product databases. Product images, when present, load from the source's HTTPS image host. Closing the dialog, cancelling or hiding the page stops camera tracks and cancels the UI request; an already submitted provider lookup may still finish on the server.

## Lookup and limits

`POST /api/barcode/lookup` accepts `{"barcode":"5099206061309"}`. It checks the format and checksum before making any external request.

1. [UPCitemdb's free Explorer API](https://devs.upcitemdb.com/) supplies general product identities. Its published free quota is 100 combined requests per day; no API key is required.
2. [Open Food Facts](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/tutorial-off-api.md) is tried when the first source has no usable match or fails.

The returned identifier must match the requested GTIN (including equivalent zero-padded representations). A result contains `barcode`, `title`, `brand`, `category`, `image` and an attributed `source`; database offer prices are not used. Coverage and correctness depend on those databases, so the UI asks the user to check the product name against the package.

The API returns 200 for a match, 400 for invalid input, 404 when both sources report no usable match, 429 after 20 valid requests per IP per minute, and 503 when a provider fails and no other source finds the item. An outage is never reported as a definitive missing product. Each external call has an 8-second timeout.

Identities are cached for one hour and misses for two minutes, with a 500-entry limit. Concurrent equivalent codes share one lookup, and at most eight distinct lookups run at once. Failures are not cached. These limits and the cache are per server process; they do not replace a provider subscription for higher traffic.

Identification is independent of live shop search. It neither confirms price/availability nor extends the financial planner's supported catalogue. A product outside that catalogue can be identified, but its name may not be accepted by the existing planner.

## Verification

- Live database requests and the local API identified `5099206061309` as Logitech C920 via UPCitemdb and `3017620422003` as Nutella via Open Food Facts. Incorrect check digits and all-zero input returned HTTP 400.
- Browser verification covered opening the dialog, invalid-code feedback, and rendering the Logitech product and source after manual entry.
- Automated tests decode generated EAN-13, EAN-8 and UPC-A image pixels using the production scanner and reject an image with an incorrect check digit. Lookup tests cover identity matching, malformed responses, provider fallback, caching, concurrent request sharing and outage handling.
- The browser tool stalled during file selection and later timed out at its origin approval gate, so the complete photo-upload UI flow was not verified. Physical camera scanning was not tested in this environment.

Implementation reference: [ZXing browser API](https://github.com/zxing-js/browser).
