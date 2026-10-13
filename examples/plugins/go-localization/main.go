// Print a complete Spanish collector localization bundle using the standard library.
// Run: go run main.go > collector-es.json
// Install the JSON through the framework's collector localization configuration.
package main

import (
	"encoding/json"
	"os"
)

const spanish = `{
  "protocol": "digital-card-localization@1",
  "locale": "es",
  "messages": {
    "nav.wallet": "Cartera",
    "nav.shop": "Descubrir",
    "nav.packs": "Mis sobres",
    "nav.features": "Funciones del framework",
    "account.heading": "TU CUENTA",
    "account.you": "Tú",
    "account.cards": {
      "one": "{count} carta",
      "other": "{count} cartas"
    },
    "account.sealedPacks": {
      "one": "{count} sobre sellado",
      "other": "{count} sobres sellados"
    },
    "status.working": "Procesando…",
    "status.saved": "Cambios guardados.",
    "wallet.title": "Tu cartera",
    "wallet.description": "Cada cuenta tiene sus propios saldos. Las compras de sobres y las conversiones actualizan estos saldos al momento.",
    "wallet.tradable": "Intercambiable",
    "wallet.notTradable": "No intercambiable",
    "wallet.value": "{tradability} · Valor: {amount} unidades base",
    "wallet.convert": "Convertir monedas",
    "wallet.amount": "Cantidad que gastar",
    "wallet.from": "De",
    "wallet.to": "A",
    "wallet.converted": "Se convirtieron {amount} {from} en {received} {to}.",
    "wallet.wholeUnits": "Elige una cantidad que se convierta en unidades enteras. Se rechazan los resultados fraccionarios.",
    "artwork.back": "Mostrar el reverso del sobre",
    "artwork.front": "Mostrar el anverso del sobre",
    "artwork.subtitle": "CARTAS COLECCIONABLES",
    "artwork.reveal": "Ilustración de apertura del sobre",
    "shop.title": "Encuentra tu próximo descubrimiento",
    "shop.description": "Elige un sobre, revisa su contenido y precio y ábrelo en Mis sobres.",
    "shop.stepBuy": "Comprar un sobre",
    "shop.stepBuyDescription": "Usa la moneda de tu cuenta",
    "shop.stepReveal": "Revelar tus cartas",
    "shop.stepRevealDescription": "Abre el sobre en Mis sobres",
    "shop.stepCollect": "Hazlo tuyo",
    "shop.stepCollectDescription": "Inspecciona las cartas y crea un álbum",
    "shop.cardsPerPack": {
      "one": "{count} carta por sobre",
      "other": "{count} cartas por sobre"
    },
    "shop.duplicateProtection": " · Protección contra duplicados",
    "shop.pityPersonal": "La garantía acumulativa busca {rarity} o una rareza superior a más tardar en el sobre {after} desde tu última carta ordinaria que cumplió el objetivo · {progress}/{after} sobres. Una carta ordinaria que cumple el objetivo reinicia la garantía; las cartas especiales no. Cuando corresponde, la garantía se aplica a la primera extracción de la primera posición de cartas ordinarias. Los sobres sellados cuentan.",
    "shop.pityLegacy": "{rarity} o una rareza superior a más tardar en la compra {after} desde tu último sobre que cumplió el objetivo · {progress}/{after} intentos sin éxito. Los sobres sellados cuentan.",
    "shop.duplicatesInventory": "Las extracciones de cartas ordinarias evitan las cartas que ya posees y las de sobres anteriores de esta compra, incluidas las cartas especiales de esos sobres. También evitan repetir cartas ordinarias dentro del sobre actual.",
    "shop.duplicatesPack": "Las extracciones de cartas ordinarias evitan repetir cartas dentro de cada sobre; esta comprobación se reinicia en el siguiente sobre.",
    "shop.inserts": "Las cartas especiales omiten el filtro de duplicados.",
    "shop.fallbackAllow": "Si no queda ninguna carta elegible sin repetir para una extracción protegida, la alternativa permite repetir una carta.",
    "shop.fallbackReject": "Si ninguna carta elegible sin repetir puede cubrir una extracción protegida, la compra falla.",
    "shop.availableFrom": "Desde {date}",
    "shop.availableUntil": " · Hasta {date}",
    "shop.ticketsSummary": "Ver cartas y cantidades de boletos",
    "shop.ratesSummary": "Ver cartas y probabilidades",
    "shop.draws": {
      "one": "{count} extracción por sobre de este grupo",
      "other": "{count} extracciones por sobre de este grupo"
    },
    "shop.poolTickets": " · {count} boletos configurados",
    "shop.remaining": " · {count} restantes",
    "shop.tickets": {
      "one": "{count} boleto configurado",
      "other": "{count} boletos configurados"
    },
    "shop.deckExplanation": "Todos los sobres de una compra extraen boletos de cada grupo sin reposición. Un boleto extraído no puede volver a extraerse en ese lote, por lo que las probabilidades cambian entre extracciones. Las cantidades de boletos configurados no son probabilidades fijas e independientes. Las existencias finitas pueden reducir los boletos disponibles.",
    "shop.conditionalTickets": "La elegibilidad por duplicados y la garantía acumulativa personal pueden cambiar qué boletos son elegibles.",
    "shop.codeSupply": "Las existencias de códigos importados también limitan los boletos elegibles. Los grupos de códigos compartidos pueden cambiar antes de la compra.",
    "shop.quoteSupply": "Tu cotización comprueba las existencias elegibles actuales.",
    "shop.baseRates": "Probabilidades base. Las ediciones restantes y la protección contra duplicados afectan a las cartas elegibles.",
    "shop.quantity": "Sobres",
    "shop.activation": {
      "one": "Hasta {count} recompensa adjunta puede requerir activación después de la compra. La entrega del sobre no confirma la activación de la recompensa. Estas recompensas no se pueden usar hasta que se confirme su activación. Si sigue pendiente, contacta al operador para recuperar la activación original.",
      "other": "Hasta {count} recompensas adjuntas pueden requerir activación después de la compra. La entrega del sobre no confirma la activación de las recompensas. Estas recompensas no se pueden usar hasta que se confirme su activación. Si sigue pendiente, contacta al operador para recuperar la activación original."
    },
    "shop.review": {
      "one": "Revisa {count} sobre por {amount} {currency}.",
      "other": "Revisa {count} sobres por {amount} {currency}."
    },
    "shop.reviewCodeSupply": "La disponibilidad depende de las existencias actuales de códigos importados.",
    "shop.reviewAllocation": "La compra utiliza esta cotización de asignación revisada.",
    "shop.reviewReady": "La cotización está lista. Revisa la cantidad de sobres y el precio antes de comprar.",
    "shop.reviewActivationReady": "La cotización está lista. Revisa la cantidad de sobres, el precio y el aviso de activación de recompensas antes de comprar.",
    "shop.purchased": {
      "one": "Se compró {count} sobre. Elige Abrir sobre para revelar tus cartas.",
      "other": "Se compraron {count} sobres. Elige Abrir sobre para revelar tus cartas."
    },
    "shop.activationDelivered": {
      "one": "{count} recompensa adjunta estaba pendiente de activación al entregarse. Consulta los detalles actuales de la carta para ver su estado de activación.",
      "other": "{count} recompensas adjuntas estaban pendientes de activación al entregarse. Consulta los detalles actuales de las cartas para ver su estado de activación."
    },
    "shop.retry": "Reintentar la compra original · {amount} {currency}",
    "shop.buyReviewed": "Comprar sobres revisados · {amount} {currency}",
    "shop.reviewButton": "Revisar compra · {amount} {currency}",
    "shop.buy": "Comprar · {amount} {currency}",
    "shop.unavailable": "No disponible actualmente",
    "shop.changedView": "La vista de compra o la cuenta conectada ha cambiado. Revisa la compra de nuevo.",
    "shop.changedQuantity": "La cantidad de sobres ha cambiado. Revisa la compra de nuevo.",
    "shop.changedPrice": "El precio del sobre ha cambiado. Revisa el precio actualizado antes de comprar.",
    "allocation.needsReview": "El intento de asignación necesita revisión. Comprueba su estado antes de reconocerlo y solicitar una nueva cotización.",
    "allocation.check": "Comprobar intento de asignación",
    "allocation.acknowledge": "Reconocer intento de asignación",
    "allocation.invalidStatus": "Respuesta de estado de asignación no válida",
    "allocation.checkFirst": "Comprueba el intento de asignación antes de reconocerlo",
    "allocation.invalidAcknowledgement": "Respuesta de reconocimiento de asignación no válida",
    "allocation.checked": "Estado de asignación comprobado.",
    "allocation.acknowledgedUnresolved": "Intento de asignación reconocido. Resuelve la compra original antes de solicitar una nueva cotización.",
    "allocation.acknowledged": "Intento de asignación reconocido. Revisa una nueva cotización antes de comprar.",
    "allocation.completed": "Esta asignación se completó. Recupera el resultado de la compra original o consulta Mis sobres.",
    "allocation.stale": "La asignación está desactualizada.",
    "allocation.pending": "Hay un intento de asignación pendiente.",
    "allocation.abandon": "Reconoce este intento inactivo para abandonarlo. Esto no compra sobres.",
    "allocation.retryOriginal": "Reintenta la compra original para resolver su resultado guardado antes de solicitar una nueva cotización.",
    "allocation.freshReview": "No hay ningún intento de asignación activo. Elige Revisar compra para solicitar una nueva cotización.",
    "packs.title": "Tus sobres",
    "packs.description": "Los sobres sellados están listos para abrirse. Puedes volver a ver los sobres abiertos sin gastar moneda ni recibir cartas adicionales.",
    "packs.opened": "Abierto",
    "packs.sealed": "Sellado",
    "packs.replay": "Volver a ver el sobre",
    "packs.open": "Abrir sobre",
    "packs.replaying": "Mostrando las cartas guardadas de nuevo. Sin cargos adicionales.",
    "packs.openSuccess": "Sobre abierto. Revela las cartas a continuación.",
    "packs.empty": "Todavía no tienes sobres",
    "packs.emptyDescription": "Compra tu primer sobre para empezar a coleccionar.",
    "packs.browse": "Explorar sobres",
    "opener.complete": "Tus cartas están reveladas",
    "opener.title": "Revela tus cartas",
    "opener.idle": "Elige un sobre sellado arriba. Tras abrirlo, sus cartas pertenecen a tu colección.",
    "opener.loading": "Cargando las cartas confirmadas…",
    "opener.progress": "{revealed} de {total} reveladas · Las cartas ya están guardadas en tu colección.",
    "opener.next": "Revelar siguiente",
    "opener.all": "Revelar todas",
    "opener.replay": "Repetir revelación",
    "opener.new": "Nueva en tu colección",
    "opener.duplicate": "Duplicada al abrir",
    "opener.card": "Carta {number}",
    "card.label": "{name}, {rarity}",
    "card.serialLabel": "{name}, {rarity} {serial} de {total}",
    "recovery.title": "Cambios sin confirmar",
    "recovery.description": "Recupera estos cambios revisados antes de empezar otros. La recuperación usa la solicitud original.",
    "recovery.purchase": "compra de sobres",
    "recovery.openPack": "apertura de sobres",
    "recovery.convert": "conversión de monedas",
    "recovery.action": "Recuperar {change}",
    "recovery.product": "{count} × {product}",
    "recovery.success": "Resultado original recuperado."
  }
}`

func main() {
	var bundle map[string]any
	if err := json.Unmarshal([]byte(spanish), &bundle); err != nil {
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(bundle); err != nil {
		os.Exit(1)
	}
}
