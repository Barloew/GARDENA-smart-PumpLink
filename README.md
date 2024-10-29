# GARDENA-smart-PumpLink
Designed for GARDENA smart gardens with leakage issues, this project will automatically start and stop your GARDENA smart Pressure Pump based on valve activity from your select GARDENA smart Irrigation Control and/or smart Water Control devices.

## Useless? Perhaps
If you **use GARDENA smart Irrigation Control and/or GARDENA smart Water Control devices in connection with a GARDENA smart Pressure Pump** and your installation is without leakage issues, then you really don't need this project. The pump's automatic flow setting should ensure that the pump starts automatically as water demand causes pressure to drop below a treshold. Reveresly, this setting will ensure that the pump stops automatically when pressure rises above a treshold.  

### Consider when automatic flow setting causes unintended pump cycling
However, in the unfortunate event that there is leakage in your piping system, the automatic flow setting can cause the pump to uncontrollably start, short cycle and/or never stop. This will force you to configure the pump to manual or scheduled switching. Consequently, you need to take extra steps to independently control your pump. If you don't like that, then this project is for you! 

### Apple HomeKit users benefit more 
If you also happen to be an Apple user, then you're given the option to control your GARDENA smart Irrigation Control and GARDENA smart Water Control devices using HomeKit. Unfortunately, HomeKit does n't give you the option to control your GARDENA smart Pressure Pump independently. So if your pump is set to manual or scheduled switching there is no way for you to control it using HomeKit. Now, if you want your pump to respond to the flipping of a HomeKit valve switch, HomeKit automation. or Siri command, this project will benefit you even more!   

### Serverless, free and secure
This project utilizes [Vercel](https://vercel.com) for serverless deployment and secure data storage, so you don't have to worry about maintaing a server, certificate and DNS record. It uses Husqvarna's GARDENA smart system and Authentiation APIs for secure garden and device communication. Use of Vercel's serverless platform under the terms of its Personal (Hobby) account is free of charge. Membership and use of [Husqvarna's Developer program](https://developer.husqvarnagroup.cloud) platform is free of charge as well.     

## Features

+ **Automated Pump Control:** Automatically turns your GARDENA smart Pressure Pump on or off based on the activity of your GARDENA smart Irrigation Control and/or GARDENA smart Water Control device valves.
+ **Device Linking:** Allows you to link multiple valves to a single pump, coordinating their operation seamlessly.
+ **OAuth Integration:** Securely connects to your Husqvarna Developer Portal application using OAuth 2.0.
+ **Webhook Handling:** Receives and processes real-time events from your GARDENA smart devices to respond to changes promptly.

## Deployment

### Github
1. **Sign in to Github:** If you don't have an account, sign up here at [github.com](https://github.com/signup) . Vercel Deploy will take care of cloning the repository to your account.
   
### Vercel
1. **Sign in to Vercel:** If you don't have an account, sign up at [vercel.com](https://vercel.com/signup)
2. **Deploy:** Click "Deploy" to start the deployment process [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBarloew%2FGARDENA-smart-PumpLink&project-name=my-gardena-smart-pumplink&repository-name=gardena-smart-pumplink)

### Husqvarna
1. **Sign in to Huqvarna Developer Portal:** [Sign in with your Husqvarna Group account](https://developer.husqvarnagroup.cloud/docs/get-started#1log-in-with-your-husqvarna-group-account-same-as-husqvarna-automower-connect-and-gardena-smart-system-credentials) (same as GARDENA smart system credentials).
2. Visit your deployed GARDENA smart PumpLink project on Vercel, to be guided through the creation and configuration of your Husqvarna Developer application.

## Contributing
This is a hobby project and my skills and time are limited. Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.
