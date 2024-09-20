declare module "calculate-power" {
  /**
   * Calculates the power of the given ArrayBuffer data.
   *
   * @param sample - The input ArrayBuffer to be processed.
   * @returns The calculated power as a number.
   */
  function calculatePower(sample: ArrayBuffer): number;

  export default calculatePower;
}
