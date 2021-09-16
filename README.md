A -Requirements
1. Nodejs V10 or above
2. npm v3 or above
3. Registred SIM cards
4. Dongle
5. Raspberry PI
6. Network cable


B Configurations
1 . Change the configurations in file config/phone.json

     phone = Target number where messages will be sent
     test_number = Number of someone from NRB monitoring the service
     test_messages = This is the message that will be sent to the test number every time the service starts e.g after reboot
     mode = either 'PDU' or 'SMS', PDU preferred
     max_sim_msgs = max messages for which service has to clear processed messages in inbox
     
     
2 . Change configurations in the file config/settings.json 

     mode = This is either HQ of FC
     local_ebrs_url = This has to be the link to the eBRS application running at the site
     modem_path = This is the mount point of the dongle, in most cases its at /dev/ttyUSB0
     environment = This is either development or production
     check_inbox_interval = Time in seconds for service to check received SIM messages
          

C. Hardware configurations
   - Insert the SIM card in the dongle
   - Plug the dongle to the Raspberry PI
   - Plug in the ethernet cable to the Raspberry Pi
   - Note the IP address assigned by running the "ifconfig" command
   - Make the IP address above static
   - Ping the IP address of server to make sure you are on same network
   

D. Starting the Service

 - Run the command: "pm2 start index.js" while inside the application
 - Run the command:  "pm2 save" to make sure the service restarts itself after boot.

