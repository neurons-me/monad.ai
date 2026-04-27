<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1760759569/me_pio6qj.png" />
  <img src="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1762832023/me.profile-removebg-preview_1_bskwyz.png" alt=".me Logo" width="203" />
</picture>


# monad.ai
###### Serve `me://` 
Your computer has a name on the network.`monad.ai` turns that name into something meaningful — a place where your data lives, your identity is anchored, and any app can find what it needs about you.

------

## The idea in one sentence
Run this on any machine, and that machine becomes **your node** — a place that knows who you are and answers questions about you.

------

## What it looks like
You install it. You run it. Now you have a personal server that speaks a simple language:

```
"give me suiGn's profile name"
"write that suiGn's email is suign@example.com"
"who is suiGn and what do they have"
```

Any app, any device, any language can talk to it.

------

## How it works
It's a service you run locally or on any machine you control.
It has one job: **answer questions about a namespace**.

A **namespace** is just a name — like a domain name`jabellae.cleaker.me` or `myComputerHostName.local` your hostname on a local network.

When an app asks:

```
GET /profile/name
Host: suiGn.cleaker.me
```

It gets back: `"Sui Gn"`

That's it.

------

## The pieces
There are three things working together:

**[.me](https://github.com/neurons-me/.me)** — the engine. Knows how to store, encrypt, and derive your data from a single seed.

**monad.ai** — the surface. Takes that engine and puts it on the network so other things can talk to it.
**[cleaker](https://github.com/neurons-me/cleaker)** — the connector. Takes your identity and plugs it into a namespace so apps can find you.

------

## Where to go from here
- **Want to run it?** → [npm/README.md](https://claude.ai/chat/npm/README.md)
- **Want to understand the protocol?** → [Namespace Resolution Protocol](https://claude.ai/docs/en/Namespace Resolution Protocol.md)
- **Want to build an app on top of this?** → [this.me on npm](https://npmjs.com/package/this.me)
- **Want to understand the big picture?** → [neurons.me](https://neurons.me/)

------

**MIT —** [neurons.me](https://neurons.me/)



<img src="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1760629064/neurons.me_b50f6a.png" style="zoom:34%;" />
