import crypto from "crypto";
import { readFileSync } from 'fs';

const public_key = readFileSync('./crypto_keys/public.pem');
const private_key = readFileSync('./crypto_keys/private.pem');

export const encrypt = str => crypto
  .publicEncrypt(public_key, Buffer.from(str, "utf-8"))
  .toString("base64");

export const decrypt = str => crypto
  .privateDecrypt(private_key, Buffer.from(str, "base64"))
  .toString("utf-8");
