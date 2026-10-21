"use client";
import { useState,type InputHTMLAttributes } from "react";

export function PasswordInput(props:InputHTMLAttributes<HTMLInputElement>){const[visible,setVisible]=useState(false);return <span className="password-field"><input {...props} type={visible?"text":"password"}/><button type="button" className="password-toggle" aria-label={visible?"Ocultar senha":"Mostrar senha"} title={visible?"Ocultar senha":"Mostrar senha"} onClick={()=>setVisible(value=>!value)}>{visible?"◉":"◌"}</button></span>}
