import { IsEmail, IsString, Length, Matches } from "class-validator";

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(3, 24)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: "username can only contain letters, numbers, and underscores"
  })
  username!: string;

  @IsString()
  @Length(8, 72)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 72)
  password!: string;
}
