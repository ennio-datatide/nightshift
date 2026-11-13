# Channels for an assistant

Checked 13 November 2026 on official pages (Telegram Bot API, Meta WhatsApp Business Platform).
Prices change: confirm on the official page before quoting one to the owner.

## Telegram: the easy start

- A bot is free. The owner creates it with @BotFather and stores the token in the secret store.
- It answers one to one and in groups of up to 200,000 members. To read every group message it must
  be an admin of the group.
- Limits: a bot cannot create a group, and cannot write first to someone who never wrote to it.
- Best for: a course, a community, a group with a bot, and any first version.

## WhatsApp: one to one, with a business number

- Groups: no. The WhatsApp Groups API needs an Official Business Account (verified company, 30 days
  on the platform, approved name) and caps a group at 8 people. Unofficial libraries (Baileys,
  whatsapp-web.js) break WhatsApp's terms and can get the number banned.
- Test number: Meta gives a free test number, but it only talks to 5 phones registered by hand with
  a code. Good for a demo, not for customers.
- Real use: a number of the owner's own that is not in any WhatsApp app (for example one from
  Twilio), a payment method in Meta, an approved display name and, to message many people,
  business verification (days). Meta charges per message: replies inside the 24-hour window after
  the person writes are cheap or free; messages the owner starts (reminders) use approved templates
  and cost cents each.
- Best for: a business whose customers already write on WhatsApp, once the number is verified.

## SMS: the US and Canada

- WhatsApp is a minority channel in the US (about a third of adults); SMS and iMessage dominate.
- Business SMS in the US needs A2P 10DLC registration of the number; the US and Canada require the
  recipient's consent.
- Best for: an English-speaking assistant for North American customers.

## Web chat and voice: a service first

- A ready service (ElevenLabs Agents for text and voice, Tidio, Crisp, Intercom Fin) gives a widget
  for the website in an afternoon, from uploaded documents.
- A phone line for real customers needs a number (for example Twilio); a call button on the website
  is enough to try it.
- The service only knows what the owner uploads; an own assistant can read live data. Start with
  the service.
