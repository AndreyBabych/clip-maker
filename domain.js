import {z} from 'zod';
export const sceneSchema=z.object({id:z.uuid(),title:z.string().min(1).max(200),start:z.number().nonnegative(),end:z.number().positive(),description:z.string().max(20000),prompt:z.string().max(20000),approved:z.boolean()}).refine(s=>s.end>s.start,{message:'Scene end must follow start'});
const reference=z.object({id:z.uuid(),name:z.string().min(1).max(200),description:z.string().max(20000),approved:z.boolean()});
export const projectSchema=z.object({title:z.string().min(1).max(200),idea:z.string().max(50000),ratio:z.enum(['16:9','9:16','1:1']),archived:z.boolean(),scenes:z.array(sceneSchema).max(500),characters:z.array(reference).max(100),locations:z.array(reference).max(100)});
