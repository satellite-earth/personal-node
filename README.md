> [!IMPORTANT]
> This is pre-alpha software! The first release of the new Satellite application stack will soon be ready (at which point this notice will be removed) but until then expect that things will be moved around, changed, and deleted without warning. In fact we currently make no guarantees about anything.
>
> BUILD IN PUBLIC

# Satellite Private Node

A nostr relay with an integrated [blossom](https://github.com/hzrd149/blossom) media proxy.

Most nostr user's have their data scattered across multiple relays. Wouldn't it be cool if you had your own relay just for your stuff? (and maybe your follows too?)

Satellite private node:

- Backs up all your nostr events and media files that you care about (i.e. notes and media from yourself and the people you follow) in a performant SQLite database
- Makes all this data available on your local machine via a local nostr relay that can be added to other nostr apps to speed them up
- Can export your nostr events database as a `.jsonl` file with optional zstd compression
- Can connect to other nodes via hyperdht

Much more info forthcoming
