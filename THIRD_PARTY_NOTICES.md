# Third-party notices

WebWire is MIT licensed. Dependencies retain their own licenses and notices.

Runtime dependency licenses (the installed dependency files are authoritative):

| Dependency                | License    | Purpose                                     |
| ------------------------- | ---------- | ------------------------------------------- |
| @modelcontextprotocol/sdk | MIT        | Official MCP server and client protocol     |
| @mozilla/readability      | Apache-2.0 | Article extraction                          |
| commander                 | MIT        | CLI argument parsing                        |
| fast-xml-parser           | MIT        | Bounded RSS/Atom XML parsing                |
| ipaddr.js                 | MIT        | Public IP address classification            |
| linkedom                  | ISC        | Inert DOM parsing without a browser runtime |
| turndown                  | MIT        | HTML to Markdown conversion                 |
| undici                    | MIT        | DNS-controlled dispatcher for native Fetch  |
| zod                       | MIT        | Request and response validation             |

Dependencies are installed separately by npm with their original license and
notice files. WebWire does not relicense dependency code. Source maps contain
WebWire's own source; dependency code is external to its bundles. Keep dependency
licenses and notices when redistributing a complete installation.
