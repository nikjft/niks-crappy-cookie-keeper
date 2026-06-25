# Objective

Store cookies in a mirrored server-side/client-side cookie setup to have persistent cookies despite ITP and other cookie clearing behaviors.

# Structure

## Cloudflare Worker

A cloudflare worker will accept requests and manage the mirroring of cookies.

When requested to save a cookie, it will receive the local cookie value, and then pass back a server side cookie for long-term storage with that value, prefixed with "_nccs_".

## Client-Side Script

A simple script tag that calls an external script (provided via the CF worker) along with a list of cookies to save.

e.g. `cookie_saver.init('_ga','_fbp')`

## Behavior

When the cookie saver is loaded it will pass the name and current value of the listed cookies to the online worker.

The worker will compare client vs. server-side cookies. If there is a server-side cookie saved, it will pass back that value to the script, which will in turn overwrite that cookie.

If there is not a server-side cookie saved, it will back up the client-side cookie passed as a server-side cookie, appropriately prefixed.

The worker/script will also set JS globals for each of the cookie values, prefixed with "_nccs" (e.g. `_nccs: { 'fbp' : 'foo', '_ga' : 'bar', 'ajs_anonymous_id': 'baz'}`)

This way a user can just request `window._nccs['ajs_anonymous_id']` to get the value of the `ajs_anonymous_id` cookie.

## Compute Limiting

To avoid overwhelming the server, the script should save its own cookie to track the current session - updating a timestamp of 30 minutes since last activity. Unless it has exceeded that timestamp, it will not query the server again for cookies.

## Additional Functions

**Reset Function:** A reset function is required to clear all server-side cookies and have them overwritten. Either globally or on a cookie-by-cookie basis.

**Cross-domain/explicit tracking:** It should also permit any individual cookie value to be sent as part of the URL request, so if the url contains `nccs_[cookie name]=value` it will accept that value and use that value as though it were returned server-side, overwriting the saves server side value and also setting the client-side cookie accordingly. A hard override.

**Generate random cookie:** The script should allow generation of a fresh cookie value. This would have the service return a GUID as the cookie, saved as a client and server-side cookie appropriately. This could be used for creating a unique user id for other purposes.

**Callback:** There needs to be a callback function so that other scripts can be held off until it loads, e.g. `nccs.ready(function() { /* code */ });`

## Performance

It is critical that this be exceptionally high performing. It should run at the top of the page, setting all cookies and priming the globals for the first load to ensure that ad and analytics tags are pre-set with appropriate values prior to loading.

This should be blocking (with a reasonable time-out) to guarantee success in doing this, rather than running purely asynchronously.

As much processing/logic should be moved server-side to improve edge performance as well.

## Privacy Considerations

Expectation is that the end-user would control this directly and adjust how and whether this script loads based on their own standards and CMP integration. If there are explicit hooks or functions to consider, include these if the spec as written does not handle appropriate use-cases.

# DNS 

Expectation is that any DNS could be pointed at this via CNAME or similar so that the script works in the appropriate 1st party context. All cookies should be set at a high enough level to be shared across subdomains - taking into account country standards.

# Example

There is an example-worker.js script in this directory. it is a functional CF worker that simply generates an ID. It is a reasonable starting point for the necessary functionality but does not need to be followed.