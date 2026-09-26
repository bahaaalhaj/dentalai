import { format } from 'date-fns';
import { Appointment, Profile, ToothStatus } from '../lib/supabase';


/**
 * Prepares treatment distribution data for the pie chart
 */
export function prepareTreatmentPieData(records: any[]) {
  const distribution: Record<string, number> = {
    'Healthy': 0, 'Cavity': 0, 'Filling': 0, 'Root Canal': 0, 'Extracted': 0, 'Crown': 0, 'Implant': 0
  };

  records?.forEach(r => {
    const status = r.teeth_status as ToothStatus;
    if (status) {
      Object.values(status).forEach(s => {
        const label = s.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        if (distribution[label] !== undefined) distribution[label]++;
      });
    }
  });

  const formattedPieData = Object.entries(distribution)
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
  
  return formattedPieData.length > 0 ? formattedPieData : [{ name: 'No Data', value: 1 }];
}
