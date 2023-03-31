import { padStart } from 'lodash'
import * as path from "path";

export const randomString = (length: number) => {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};
 
export const appendInstanceValue = (originalObject: any, newObject: any) => {
  for (const k in newObject) {
    if (k === 'id') {
      continue;
    }
    // eslint-disable-next-line no-prototype-builtins
    if (originalObject.hasOwnProperty(k)) {
      originalObject[k] = newObject[k];
    }
  }
  return originalObject;
};

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


export function getTokyoDayString(dayOffset: number = 0) {
  const date = getTokyoDate();
  date.setDate(date.getDate() + dayOffset)
  return formatDate(date);
}

export function formatDate(date: Date) {
  return `${date.getFullYear()}-${padStart(`${date.getMonth() + 1}`, 2, '0')}-${padStart(`${date.getDate()}`, 2, '0')}`;
}
export function formatDateTime(date: Date) {
  return `${formatDate(date)} ${padStart(`${date.getHours()}`, 2, '0')}:${padStart(`${date.getMinutes()}`, 2, '0')}`;
}
export function getTokyoDate() {
  const d = new Date();
  const len = d.getTime();
  const offset = d.getTimezoneOffset() * 60000;
  const utcTime = len + offset;
  const date = new Date(utcTime + 3600000 * 9);
  return date;
}
export const convertImageUrlTo100x100 = (url: string) => {
  const parsed = path.parse(url)
  parsed.base = `${parsed.name}_100x100${parsed.ext}`
  const result = path.format(parsed)
  return result
}
export function isInteger(str: string) {
  return /^\d+$/.test(str);
}

export function calculateAge(birthday: string) {
  const array = birthday.split('-');
  const year = Number(array[0]);
  const month = Number(array[1]);
  const day = Number(array[2]);
  const today = getTokyoDate();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() == month && today.getDate() < day)) {
    age--;
  }
  return age;
}
