/** Normal distribution CDF and inverse CDF. */

const SQRT_PI = Math.sqrt(Math.PI);
const ERF_SERIES_CUTOFF = 1.5;
const ERF_SERIES_TERMS = 25;
const ERFC_CONTFRAC_CUTOFF = 30;
const ERFC_CONTFRAC_TERMS = 50;

/** erf by power series, for |x| < 1.5. */
function erfSeries(x: number): number {
  const x2 = x * x;
  let acc = 0;
  let fk = ERF_SERIES_TERMS + 0.5;
  for (let i = 0; i < ERF_SERIES_TERMS; i++) {
    acc = 2 + (x2 * acc) / fk;
    fk -= 1;
  }
  return (acc * x * Math.exp(-x2)) / SQRT_PI;
}

/** erfc by continued fraction, for x >= 1.5. */
function erfcContfrac(x: number): number {
  if (x >= ERFC_CONTFRAC_CUTOFF) return 0;
  const x2 = x * x;
  let a = 0;
  let da = 0.5;
  let p = 1;
  let pLast = 0;
  let q = da + x2;
  let qLast = 1;
  for (let i = 0; i < ERFC_CONTFRAC_TERMS; i++) {
    a += da;
    da += 2;
    const b = da + x2;
    [p, pLast] = [b * p - a * pLast, p];
    [q, qLast] = [b * q - a * qLast, q];
  }
  return ((p / q) * x * Math.exp(-x2)) / SQRT_PI;
}

/** The error function. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return x;
  const ax = Math.abs(x);
  if (ax < ERF_SERIES_CUTOFF) return erfSeries(x);
  const cf = erfcContfrac(ax);
  return x > 0 ? 1 - cf : cf - 1;
}

/** P(X <= x) for X ~ normal(mu, sigma). */
export function normalCdf(x: number, mu: number, sigma: number): number {
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

/**
 * Inverse of {@link normalCdf}, for p in (0, 1). Wichura, M.J. (1988).
 * "Algorithm AS241: The Percentage Points of the Normal Distribution".
 */
export function normalInvCdf(p: number, mu: number, sigma: number): number {
  const q = p - 0.5;
  let num: number;
  let den: number;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    num = (((((((2.5090809287301226727e+3 * r +
      3.3430575583588128105e+4) * r +
      6.7265770927008700853e+4) * r +
      4.5921953931549871457e+4) * r +
      1.3731693765509461125e+4) * r +
      1.9715909503065514427e+3) * r +
      1.3314166789178437745e+2) * r +
      3.3871328727963666080e+0) * q;
    den = (((((((5.2264952788528545610e+3 * r +
      2.8729085735721942674e+4) * r +
      3.9307895800092710610e+4) * r +
      2.1213794301586595867e+4) * r +
      5.3941960214247511077e+3) * r +
      6.8718700749205790830e+2) * r +
      4.2313330701600911252e+1) * r +
      1.0);
    return mu + (num / den) * sigma;
  }
  let r = q <= 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  if (r <= 5) {
    r -= 1.6;
    num = (((((((7.74545014278341407640e-4 * r +
      2.27238449892691845833e-2) * r +
      2.41780725177450611770e-1) * r +
      1.27045825245236838258e+0) * r +
      3.64784832476320460504e+0) * r +
      5.76949722146069140550e+0) * r +
      4.63033784615654529590e+0) * r +
      1.42343711074968357734e+0);
    den = (((((((1.05075007164441684324e-9 * r +
      5.47593808499534494600e-4) * r +
      1.51986665636164571966e-2) * r +
      1.48103976427480074590e-1) * r +
      6.89767334985100004550e-1) * r +
      1.67638483018380384940e+0) * r +
      2.05319162663775882187e+0) * r +
      1.0);
  } else {
    r -= 5;
    num = (((((((2.01033439929228813265e-7 * r +
      2.71155556874348757815e-5) * r +
      1.24266094738807843860e-3) * r +
      2.65321895265761230930e-2) * r +
      2.96560571828504891230e-1) * r +
      1.78482653991729133580e+0) * r +
      5.46378491116411436990e+0) * r +
      6.65790464350110377720e+0);
    den = (((((((2.04426310338993978564e-15 * r +
      1.42151175831644588870e-7) * r +
      1.84631831751005468180e-5) * r +
      7.86869131145613259100e-4) * r +
      1.48753612908506148525e-2) * r +
      1.36929880922735805310e-1) * r +
      5.99832206555887937690e-1) * r +
      1.0);
  }
  let x = num / den;
  if (q < 0) x = -x;
  return mu + x * sigma;
}
