// Generate a complete collection layout using the Go standard library.
// Run: go run main.go OUTPUT_DIR
// The approved separate origin supplies /program-collection-bootstrap.js.
package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Field Notes Collection</title>
  <link rel="stylesheet" href="collection.css">
  <script type="module" src="/program-collection-bootstrap.js"></script>
</head>
<body>
  <main aria-labelledby="collection-title">
    <header><span class="eyebrow">FIELD NOTES</span><h1 id="collection-title" data-dc-collection-label="title">Collection</h1>
      <p data-dc-collection-label="description">Browse your cards and discover the catalog.</p></header>
    <section class="metrics" aria-label="Collection progress" aria-live="polite">
      <p><span data-dc-collection-label="discoveries">Discoveries</span><strong><span data-dc-collection-count="discoveries">0</span> / <span data-dc-collection-count="definitions">0</span></strong></p>
      <p><span data-dc-collection-label="totalCopies">Total copies</span><strong data-dc-collection-count="copies">0</strong></p>
      <p><span data-dc-collection-label="matching">Matching</span><strong data-dc-collection-count="matching">0</strong></p>
      <p><span data-dc-collection-label="selected">Selected</span><strong data-dc-collection-count="selected">0</strong></p>
    </section>
    <section class="filters" aria-label="Browse and filter">
      <label><span data-dc-collection-label="browse">Browse</span><select data-dc-collection-query="mode" disabled></select></label>
      <label class="search"><span data-dc-collection-label="search">Search</span><input type="search" data-dc-collection-query="search" maxlength="200" disabled></label>
      <label><span data-dc-collection-label="line">Line</span><select data-dc-collection-query="line" disabled></select></label>
      <label><span data-dc-collection-label="rarity">Rarity</span><select data-dc-collection-query="rarity" disabled></select></label>
      <label><span data-dc-collection-label="finish">Finish</span><select data-dc-collection-query="finish" disabled></select></label>
      <label><span data-dc-collection-label="sort">Sort</span><select data-dc-collection-query="sort" disabled></select></label>
      <label><span data-dc-collection-label="show">Show</span><select data-dc-collection-query="show" disabled></select></label>
      <label><span data-dc-collection-label="includeInserts">Inserts</span><select data-dc-collection-query="inserts" disabled></select></label>
    </section>
    <section class="option-finders" aria-label="Find filter and recipe choices">
      <fieldset><legend>Lines</legend>
        <label><span data-dc-collection-label="search">Search</span><input type="search" data-dc-collection-options-search="lines" maxlength="200" disabled></label>
        <div class="option-pages"><button type="button" data-dc-collection-options-page="lines" data-dc-direction="-1" data-dc-collection-label="previous" disabled>Previous choices</button>
          <button type="button" data-dc-collection-options-page="lines" data-dc-direction="1" data-dc-collection-label="more" disabled>More choices</button></div>
      </fieldset>
      <fieldset><legend>Rarities</legend>
        <label><span data-dc-collection-label="search">Search</span><input type="search" data-dc-collection-options-search="rarities" maxlength="200" disabled></label>
        <div class="option-pages"><button type="button" data-dc-collection-options-page="rarities" data-dc-direction="-1" data-dc-collection-label="previous" disabled>Previous choices</button>
          <button type="button" data-dc-collection-options-page="rarities" data-dc-direction="1" data-dc-collection-label="more" disabled>More choices</button></div>
      </fieldset>
      <fieldset><legend>Recipes</legend>
        <label><span data-dc-collection-label="search">Search</span><input type="search" data-dc-collection-options-search="recipes" maxlength="200" disabled></label>
        <div class="option-pages"><button type="button" data-dc-collection-options-page="recipes" data-dc-direction="-1" data-dc-collection-label="previous" disabled>Previous choices</button>
          <button type="button" data-dc-collection-options-page="recipes" data-dc-direction="1" data-dc-collection-label="more" disabled>More choices</button></div>
      </fieldset>
    </section>
    <section class="selection" aria-label="Selected cards">
      <p data-dc-collection-label="selectionLimit">Select up to 24 cards.</p>
      <div class="actions"><button type="button" data-dc-collection-intent="compare" data-dc-collection-label="compare" disabled>Compare</button>
        <button type="button" data-dc-collection-intent="clear" data-dc-collection-label="clear" disabled>Clear selection</button></div>
      <label><span data-dc-collection-label="recipe">Trade-up recipe</span><select data-dc-collection-recipe disabled></select></label>
      <button type="button" data-dc-collection-intent="tradeup-review" data-dc-collection-label="tradeUp" disabled>Review trade-up</button>
      <p class="review-note">Review the selected copies and recipe in the host before applying a trade-up.</p>
    </section>
    <p class="empty" data-dc-collection-label="empty">No matching cards.</p>
    <section class="cards" data-dc-collection-items aria-label="Cards"></section>
    <nav class="pagination" aria-label="Collection pages"><button type="button" data-dc-collection-intent="previous" data-dc-collection-label="previous" disabled>Previous page</button>
      <button type="button" data-dc-collection-intent="more" data-dc-collection-label="more" disabled>More cards</button></nav>
  </main>
  <template data-dc-collection-item-template>
    <article class="card">
      <button class="inspect" type="button" data-dc-item-inspect disabled><img data-dc-item-preview alt="" hidden><span class="inspect-label" data-dc-collection-label="inspect">Inspect</span><strong data-dc-item-name></strong></button>
      <p class="traits"><span data-dc-item-line></span><span data-dc-item-rarity></span><span data-dc-item-finish></span></p>
      <p class="status" data-dc-item-status></p><p><span data-dc-collection-label="totalCopies">Copies</span>: <span data-dc-item-copies></span></p>
      <p data-dc-item-tags></p><p data-dc-item-stats></p><p data-dc-item-metadata></p>
      <label class="select"><input type="checkbox" data-dc-item-select disabled><span data-dc-collection-label="selected">Select</span></label>
      <div class="preferences"><button type="button" data-dc-item-favorite data-dc-collection-label="favorite" disabled>Favorite</button>
        <button type="button" data-dc-item-wishlist data-dc-collection-label="addWishlist" disabled>Add to wishlist</button></div>
    </article>
  </template>
</body>
</html>
`

const css = `:root { color-scheme: light; font-family: system-ui, sans-serif; color: #223c35; background: #f4f2e9; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; }
main { max-width: 1180px; margin: auto; padding: clamp(12px, 3vw, 32px); }
header { border-bottom: 2px solid #346552; padding-bottom: 18px; }
.eyebrow { font-size: 12px; letter-spacing: .2em; font-weight: 700; }
h1 { font: 600 clamp(26px, 4vw, 40px) Georgia, serif; margin: 8px 0; }
p { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
.metrics p { margin: 0; padding: 12px; background: #e5e9dd; border-radius: 8px; }
.metrics strong { display: block; font-size: 22px; padding-top: 4px; }
.filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.search { grid-column: span 3; }
label { display: block; font-size: 14px; font-weight: 600; }
input, select, button { font: inherit; color: inherit; }
select, input[type="search"] { width: 100%; min-height: 44px; margin-top: 6px; border: 1px solid #718a74; border-radius: 6px; background: #fff; padding: 8px; }
button { min-height: 44px; border: 1px solid #346552; border-radius: 6px; background: #fff; padding: 8px 14px; cursor: pointer; }
button:hover:enabled { background: #e5e9dd; }
button:disabled, input:disabled, select:disabled { opacity: .65; cursor: default; }
:focus-visible { outline: 3px solid #a15716; outline-offset: 3px; }
.option-finders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
.option-finders fieldset { min-width: 0; border: 1px solid #718a74; border-radius: 8px; padding: 12px; }
.option-finders legend { font-weight: 600; }
.option-pages { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.option-pages button { flex: 1 1 100px; }
.selection { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 20px 0; padding: 16px; border: 1px solid #718a74; border-radius: 8px; }
.selection > p { flex-basis: 100%; margin: 0; }
.selection label { flex: 1 1 220px; }
.actions, .preferences { display: flex; flex-wrap: wrap; gap: 8px; }
.review-note { color: #4b6357; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 16px; }
.card { min-width: 0; border: 1px solid #718a74; border-radius: 10px; padding: 14px; background: #fff; }
.inspect { width: 100%; display: flex; flex-direction: column; gap: 8px; text-align: left; border: 0; padding: 0; background: transparent; }
.inspect img { width: 100%; height: 160px; object-fit: contain; border-radius: 6px; background: #e5e9dd; }
img:not([src]) { display: none; }
.inspect-label { font-size: 12px; color: #346552; }
.inspect strong { font: 600 22px Georgia, serif; overflow-wrap: anywhere; }
.traits { display: flex; gap: 8px; flex-wrap: wrap; }
.traits span:empty, .card p:empty { display: none; }
.status { font-weight: 600; }
.select { display: flex; gap: 8px; align-items: center; min-height: 44px; }
.select input { width: 20px; height: 20px; }
.preferences button { flex: 1 1 100px; }
.pagination { display: flex; gap: 12px; justify-content: center; padding: 24px 0; }
@media (max-width: 640px) { .filters, .metrics, .option-finders { grid-template-columns: repeat(2, minmax(0, 1fr)); } .search { grid-column: auto; } }
@media (max-width: 360px) { .filters, .option-finders { grid-template-columns: 1fr; } .pagination { flex-wrap: wrap; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go OUTPUT_DIR")
		os.Exit(1)
	}
	output := os.Args[1]
	if err := os.MkdirAll(output, 0755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, file := range []struct{ name, content string }{{"index.html", html}, {"collection.css", css}} {
		if err := os.WriteFile(filepath.Join(output, file.name), []byte(file.content), 0644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
