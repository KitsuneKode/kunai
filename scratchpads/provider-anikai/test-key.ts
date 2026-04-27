const cArray = [
  "4Z7lUo",
  "gwIVSMD",
  "PLmz2elE2v",
  "Z4OFV0",
  "SZ6RZq6Zc",
  "zhJEFYxrz8",
  "FOm7b0",
  "axHS3q4KDq",
  "o9zuXQ",
  "4Aebt",
  "wgjjWwKKx",
  "rY4VIxqSN",
  "kfjbnSo",
  "2DyrFA1M",
  "YUixDM9B",
  "JQvgEj0",
  "mcuFx6JIek",
  "eoTKe26gL",
  "qaI9EVO1rB",
  "0xl33btZL",
  "1fszuAU",
  "a7jnHzst6P",
  "wQuJkX",
  "cBNhTJlEOf",
  "KNcFWhDvgT",
  "XipDGjST",
  "PCZJlbHoyt",
  "2AYnMZkqd",
  "HIpJh",
  "KH0C3iztrG",
  "W81hjts92",
  "rJhAT",
  "NON7LKoMQ",
  "NMdY3nsKzI",
  "t4En5v",
  "Qq5cOQ9H",
  "Y9nwrp",
  "VX5FYVfsf",
  "cE5SJG",
  "x1vj1",
  "HegbLe",
  "zJ3nmt4OA",
  "gt7rxW57dq",
  "clIE9b",
  "jyJ9g",
  "B5jXjMCSx",
  "cOzZBZTV",
  "FTXGy",
  "Dfh1q1",
  "ny9jqZ2POI",
  "X2NnMn",
  "MBtoyD",
  "qz4Ilys7wB",
  "68lbOMye",
  "3YUJnmxp",
  "1fv5Imona",
  "PlfvvXD7mA",
  "ZarKfHCaPR",
  "owORnX",
  "dQP1YU",
  "dVdkx",
  "qgiK0E",
  "cx9wQ",
  "5F9bGa",
  "7UjkKrp",
  "Yvhrj",
  "wYXez5Dg3",
  "pG4GMU",
  "MwMAu",
  "rFRD5wlM",
];

function generateSecretKey(e: string | number) {
  if (e === undefined) return "rive";
  try {
    let t, n;
    let r = String(e);
    if (isNaN(Number(e))) {
      let sum = r.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      t = cArray[sum % cArray.length] || btoa(r);
      n = Math.floor((sum % r.length) / 2);
    } else {
      let i = Number(e);
      t = cArray[i % cArray.length] || btoa(r);
      n = Math.floor((i % r.length) / 2);
    }

    let i = r.slice(0, n) + t + r.slice(n);

    const hash2 = (e: string) => {
      let t = 0;
      for (let n = 0; n < e.length; n++) {
        let r = e.charCodeAt(n);
        let i =
          (((t = (r + (t << 6) + (t << 16) - t) >>> 0) << (n % 5)) | (t >>> (32 - (n % 5)))) >>> 0;
        t ^= (i ^ ((r << (n % 7)) | (r >>> (8 - (n % 7))))) >>> 0;
        t = (t + ((t >>> 11) ^ (t << 3))) >>> 0;
      }
      t ^= t >>> 15;
      t = ((65535 & t) * 49842 + ((((t >>> 16) * 49842) & 65535) << 16)) >>> 0;
      t ^= t >>> 13;
      t = ((65535 & t) * 40503 + ((((t >>> 16) * 40503) & 65535) << 16)) >>> 0;
      return (t ^= t >>> 16).toString(16).padStart(8, "0");
    };

    const o = (e: string) => {
      let t = String(e);
      let n = 3735928559 ^ t.length;
      for (let e = 0; e < t.length; e++) {
        let r = t.charCodeAt(e);
        r ^= ((131 * e + 89) ^ (r << (e % 5))) & 255;
        n = (((n << 7) | (n >>> 25)) >>> 0) ^ r;
        let i = (65535 & n) * 60205;
        let o = ((n >>> 16) * 60205) << 16;
        n = (i + o) >>> 0;
        n ^= n >>> 11;
      }
      n ^= n >>> 15;
      n = ((65535 & n) * 49842 + (((n >>> 16) * 49842) << 16)) >>> 0;
      n ^= n >>> 13;
      n = ((65535 & n) * 40503 + (((n >>> 16) * 40503) << 16)) >>> 0;
      n ^= n >>> 16;
      n = ((65535 & n) * 10196 + (((n >>> 16) * 10196) << 16)) >>> 0;
      return (n ^= n >>> 15).toString(16).padStart(8, "0");
    };

    return btoa(o(hash2(i)));
  } catch (err) {
    return "topSecret";
  }
}

const ani_id = "c4ey";
console.log(`Key for ${ani_id}: ${generateSecretKey(ani_id)}`);
console.log(`Expected prefix: xQm9tJfLwGhz`);
