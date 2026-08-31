export function parseSurveillance(status) {

  if (!status) return [];

  return status.split(", ").map(item => {

    const [type, stage] = item.split(":");

    return {
      type,
      stage
    };

  });

}