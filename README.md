# Digital Card Framework

**Build a digital card collection around your own artwork, community, or game.**

Digital Card Framework is a self-hosted backend for creating, distributing, and collecting digital cards. It includes a visual **Card Maker Studio**, an interactive card player, and a basic reference website. Use them together, embed individual components, or connect your own frontend.

**Active development:** implemented features are still being hardened; APIs may change.

![Two layered cards turning back and forth, with shifting depth, fireworks, petals, and reflected light](https://github.com/user-attachments/assets/af94fd67-6148-474a-9720-2d243f186a86)

*A 30 fps loop from the player, showing two cards in a connected scene. Artwork is hosted separately.*

## Run locally

For version 0.2.0, install **Node.js 24.14.0 or newer** and **pnpm 11.19.0**, then download or clone this repository. In its root directory, run:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open **http://127.0.0.1:4317** in your browser. Rowan is the fictional operator account, with **Administration** and **Creator studio** tabs; Morgan is a fictional collector. Use the account selector and **Switch** to try either role. Sample cards and starting balances are included, so you can buy and open packs, browse your collection, and try the other tabs without editing code.

Progress is saved in `data/demo.sqlite`, and presentations in `data/presentations/`. Stop the server with Ctrl+C; restarting keeps that local data. If port 4317 is occupied, stop the other server or set the `PORT` environment variable before starting, then open the URL printed by the server.

This launch binds only to your computer's loopback interface. The fictional accounts are for local exploration. A shared deployment uses the production host and an external identity provider; see [access and identity](docs/access-and-identity.md) and the configuration fields in [`.env.example`](.env.example). Domain, HTTPS, hosting and identity-provider setup are separate deployment tasks.

## What it does today

| Area | Features |
| --- | --- |
| Cards | Simple images or layered, animated faces; backs, foil and holographic finishes, depth, flip/zoom, and connected compositions |
| Collections | Accounts, owned copies, numbered editions and ownership history; search, favorites, wishlists, and public or private albums |
| Distribution | Configurable packs, rarity, prices, limited editions, opening reveals, duplicate rules, and trade-ups |
| Trading and shops | Card/currency offers, administrator and player shops, scheduled releases, and free draws for a chance to buy limited releases |
| Content and rewards | Bulk catalog imports, custom stats and metadata, private code cards, and opening rewards connected through host integrations |

## Card Maker Studio

![Card Maker Studio with a layered card preview, layer list, finish controls, and export tools](https://github.com/user-attachments/assets/3707d905-4606-4882-ab36-4e538c48b64c)

- **Start with your art:** turn an image into a card, import supported PSD/ORA/ZIP layers, or open an existing card package.
- **Text and stats:** edit typography, embed custom fonts, bind typed metadata, and reuse masks, styles and templates. Administrators can enforce versioned [card policies](docs/card-authoring-policies.md).
- **Build the look:** arrange front/back layers, adjust depth and finishes, paint effect masks, and add animated GIF or video layers.
- **Preview and hand off:** turn the card live, undo/redo changes, save local drafts and editable projects, capture still previews, and export portable `.dcard` files.

Layered imports report compatibility limits. Advanced motion can require code or JSON. The reference site connects visual editing to reviewed catalog publication; exporting a card does not issue an owned copy.

## Default administration panel

The reference website includes an **Administration** area for authorized operators. Manage line sales, pack prices and discounts, rarity weights, account restrictions, and card grants/removals through named controls. Website controls pause pack purchases, direct trading, and user shops independently. Changes include a review, a reason, and recorded history.

Basic mode keeps everyday tasks visible; Advanced adds configuration detail. Existing host and catalog restrictions remain authoritative. The panel is an optional, replaceable interface built on public administration APIs. See the [administration guide](docs/admin-panel.md) to embed it or build your own.

## Make it yours

Define your artwork, card data, rarities, currencies, pack rules, and trading policies. Developers can replace views, themes, renderers, and host adapters through public APIs, or use the backend without the bundled website. Optional rendering adapters support additional media.

The reference website provides basic collecting workflows. Major layout changes, custom effects, and connections to identity, payment, or game services require developer work. This is a collection framework, not a ready-made card battle game or a drag-and-drop website builder. You supply the artwork and hosting; blockchain is not required.

## Planned

- Simpler setup with independently selectable collecting, pack, trading, and shop capabilities.
- A more complete artist workflow spanning cards, pack artwork, and albums.
- Broader plugin support across programming languages, clearer extension contracts, improved storage and performance, and release hardening.

These are development goals, not yet supported features.

## Documentation

**The wiki is coming soon.** It will be the home for setup instructions, artist tutorials, customization guides, API references, and operations documentation.

For now, use the [existing technical documentation](docs), [card authoring and player guides](docs/complex-cards/README.md), and [customization examples](docs/customization-recipes.md).
