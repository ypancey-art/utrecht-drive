// Nicknames for playing together: an adjective and an animal. Only the two word numbers are sent
// over the network; every device turns them into text from its own list, so nobody can make
// another player's screen show words of their own.
import { getLang } from '../i18n';

const NAMES = {
  nl: {
    a: ['Snelle', 'Gekke', 'Stoere', 'Vrolijke', 'Slimme', 'Dappere', 'Turbo', 'Super', 'Wilde', 'Coole', 'Grappige', 'Blije'],
    b: ['Vos', 'Uil', 'Panda', 'Tijger', 'Haai', 'Egel', 'Leeuw', 'Draak', 'Pinguïn', 'Koala', 'Wolf', 'Otter', 'Raket', 'Eekhoorn'],
  },
  en: {
    a: ['Fast', 'Crazy', 'Brave', 'Happy', 'Clever', 'Bold', 'Turbo', 'Super', 'Wild', 'Cool', 'Funny', 'Jolly'],
    b: ['Fox', 'Owl', 'Panda', 'Tiger', 'Shark', 'Hedgehog', 'Lion', 'Dragon', 'Penguin', 'Koala', 'Wolf', 'Otter', 'Rocket', 'Squirrel'],
  },
};
const NA = NAMES.nl.a.length, NB = NAMES.nl.b.length;

/** Word numbers: [adjective, animal]. */
export type Nick = [number, number];

export const randomNick = (): Nick => [Math.floor(Math.random() * NA), Math.floor(Math.random() * NB)];
export const validNick = (n: unknown): n is Nick =>
  Array.isArray(n) && n.length === 2 && Number.isInteger(n[0]) && Number.isInteger(n[1]) && n[0] >= 0 && n[0] < NA && n[1] >= 0 && n[1] < NB;
export const nickName = (n: Nick) => {
  const l = NAMES[getLang()];
  return `${l.a[n[0]]} ${l.b[n[1]]}`;
};
